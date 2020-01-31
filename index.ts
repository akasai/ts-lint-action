import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Octokit from '@octokit/rest'
import * as fs from 'fs'
import * as glob from 'glob'
import { Configuration, Linter } from 'tslint'

type LEVEL = 'notice' | 'warning' | 'failure'

enum CONCLUSION {
  FAILURE = 'failure',
  SUCCESS = 'success',
  NEUTRAL = 'neutral',
}

enum MODE {
  ALL = 'all',
  COMMIT = 'commit',
}

const LINTER = 'Linter'

const main = async () => {
  const { repo: { owner, repo }, sha: head_sha } = github.context

  try {
    const lintFile = core.getInput('lintFile', { required: true }) // lintFile
    const token = core.getInput('token', { required: true }) // github token
    const pattern = core.getInput('pattern') // file pattern
    const mode = core.getInput('mode') || MODE.COMMIT // ALL || COMMIT (default)

    if (mode && ![MODE.ALL, MODE.COMMIT].includes(mode as MODE)) throw new Error('Bad Request: target parameter is not valid (all, commit).')
    if (mode === MODE.ALL && !pattern) throw new Error('Bad Request: all target must need pattern parameter.')

    const gitToolkit: Octokit = new github.GitHub(token)
    const check = await gitToolkit.checks.create({ owner, repo, name: LINTER, head_sha, status: 'in_progress' })

    const linter = new Linter({ fix: false, formatter: 'json' })

    let fileList
    if (mode === MODE.ALL) {
      fileList = glob.sync(pattern, { dot: true, ignore: ['./node_modules/**'] })
    } else {
      const { data: prData } = await gitToolkit.search.issuesAndPullRequests({ q: `sha:${head_sha}` })

      if (!prData.items.length) { // if pull_request is not exist = first pr
        const { data: commit } = await gitToolkit.repos.getCommit({ owner, repo, ref: head_sha })
        fileList = commit.files.map((d) => {
          return d.filename && new RegExp(/\.ts$/g).test(d.filename) ? d.filename : ''
        })
      } else { // if pull_request is exist
        const { data: prInfo } = await gitToolkit.pulls.listFiles({ owner, repo, pull_number: prData.items[0].number })
        fileList = prInfo.map((d) => {
          return d.filename && new RegExp(/\.ts$/g).test(d.filename) ? d.filename : ''
        })
      }
    }

    for (let i = 0; i < fileList.length; i++) {
      try {
        const filename = fileList[i]
        if (!filename) continue
        const inFileContents = fs.readFileSync('index.js', 'utf8')
        const configuration = Configuration.findConfiguration(lintFile, filename).results
        linter.lint(filename, inFileContents, configuration)
      } catch (e) {
        console.log('### e', e)
        throw e
      }
    }

    const lintResult = linter.getResult()

    if (!lintResult.failures.length) {
      await gitToolkit.checks.update({
        owner,
        repo,
        check_run_id: check.data.id,
        name: LINTER,
        status: 'completed',
        conclusion: CONCLUSION.NEUTRAL,
        output: {
          title: 'Tslint Check Report',
          summary: `0 errors\n0 warnings`,
        },
      })
    }

    const annotations: Octokit.ChecksCreateParamsOutputAnnotations[] = []

    for (let failure of lintResult.failures) {
      const level = { 'warning': 'warning', 'error': 'failure', 'off': 'notice' }[failure.getRuleSeverity()] || 'notice'
      annotations.push({
        path: failure.getFileName(),
        annotation_level: level as LEVEL,
        title: 'tsLint Checker',
        message: `${failure.getRuleName()}: ${failure.getFailure()}`,
        start_line: failure.getStartPosition().getLineAndCharacter().line + 1,
        end_line: failure.getEndPosition().getLineAndCharacter().line + 1,
      })
      if (annotations.length === 50 || annotations.length === lintResult.failures.length) {
        await gitToolkit.checks.update({
          owner,
          repo,
          check_run_id: check.data.id,
          name: LINTER,
          status: 'completed',
          conclusion: lintResult.errorCount ? CONCLUSION.FAILURE : CONCLUSION.SUCCESS,
          output: {
            title: 'Tslint Check Report',
            summary: `${lintResult.errorCount} errors\n${lintResult.warningCount} warnings`,
            annotations,
          },
        })
        annotations.length = 0
      }
    }
  } catch (err) {
    core.setFailed(`Action failed with error: ${err}`)
  }
}

main()
