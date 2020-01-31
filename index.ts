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
    const check = await gitToolkit.checks.create({ owner, repo, name: LINTER, head_sha, status: 'queued' })

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
      const filename = fileList[i]
      if (!filename) continue
      const inFileContents = fs.readFileSync(filename, 'utf8')
      const configuration = Configuration.findConfiguration(lintFile, filename).results
      linter.lint(filename, inFileContents, configuration)
    }

    const lintResult = linter.getResult()

    // const annotations: Octokit.ChecksCreateParamsOutputAnnotations[] = lintResult.failures.map((failure) => {
    //   const level = { 'warning': 'warning', 'error': 'failure', 'off': 'notice' }[failure.getRuleSeverity()] || 'notice'
    //   return {
    //     path: failure.getFileName(),
    //     annotation_level: level as LEVEL,
    //     title: 'tsLint Checker',
    //     message: `${failure.getRuleName()}: ${failure.getFailure()}`,
    //     start_line: failure.getStartPosition().getLineAndCharacter().line,
    //     end_line: failure.getEndPosition().getLineAndCharacter().line,
    //   }
    // })

    const annotations: Octokit.ChecksCreateParamsOutputAnnotations[] = []

    for (let failure of lintResult.failures) {
      const level = { 'warning': 'warning', 'error': 'failure', 'off': 'notice' }[failure.getRuleSeverity()] || 'notice'
      annotations.push({
        path: failure.getFileName(),
        annotation_level: level as LEVEL,
        title: 'tsLint Checker',
        message: `${failure.getRuleName()}: ${failure.getFailure()}`,
        start_line: failure.getStartPosition().getLineAndCharacter().line,
        end_line: failure.getEndPosition().getLineAndCharacter().line,
      })
      if (annotations.length === 50) {
        await gitToolkit.checks.update({
          owner,
          repo,
          check_run_id: check.data.id,
          name: LINTER,
          status: 'in_progress',
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


    // if (annotations.length > 50) annotations.length = 50 // checks limit: 50

    // await gitToolkit.checks.create({
    //   owner,
    //   repo,
    //   head_sha,
    //   name: 'Linter',
    //   status: 'completed',
    //   conclusion: lintResult.errorCount ? CONCLUSION.FAILURE : CONCLUSION.SUCCESS,
    //   output: {
    //     title: 'Tslint Check Report',
    //     summary: `${lintResult.errorCount} errors\n${lintResult.warningCount} warnings`,
    //     annotations,
    //   },
    // })

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
      },
    })
  } catch (err) {
    core.setFailed(`Action failed with error: ${err}`)
  }
}

main()
