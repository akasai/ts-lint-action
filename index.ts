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

enum LINT_TARGET {
  ALL = 'all',
  PR = 'pr',
}

const main = async () => {
  const { repo: { owner, repo }, sha: head_sha } = github.context

  try {
    const lintFile = core.getInput('lintFile', { required: true }) // lintFile
    const pattern = core.getInput('pattern', { required: true }) // file pattern
    const token = core.getInput('token', { required: true }) // github token
    const target = core.getInput('target') // ALL || PR (default)

    if (target && [LINT_TARGET.ALL, LINT_TARGET.PR].includes(target as LINT_TARGET)) throw new Error('Bad Request: target parameter is not valid (all, pr)')

    const isALL = target || LINT_TARGET.PR
    const gitToolkit: Octokit = new github.GitHub(token)
    const linter = new Linter({ fix: false, formatter: 'json' })

    let fileList
    if (isALL) {
      fileList = glob.sync(pattern, { dot: true, ignore: ['./node_modules/**'] })
    } else {
      const { data: prData } = await gitToolkit.search.issuesAndPullRequests({ q: `sha:${head_sha}` })
      const pull_number = prData.items[0].number

      const { data: prInfo } = await gitToolkit.pulls.listFiles({ owner, repo, pull_number })
      fileList = prInfo.map((d) => d.filename).filter((file) => new RegExp(/\.ts$/).test(file))
    }

    fileList.forEach((file) => {
      const inFileContents = fs.readFileSync(file, 'utf8')
      const configuration = Configuration.findConfiguration(lintFile, file).results
      linter.lint(file, inFileContents, configuration)
    })

    const lintResult = linter.getResult()

    const annotations: Octokit.ChecksCreateParamsOutputAnnotations[] = lintResult.failures.map((failure) => {
      const level = { 'warning': 'warning', 'error': 'failure', 'off': 'notice' }[failure.getRuleSeverity()] || 'notice'
      return {
        path: failure.getFileName(),
        start_line: failure.getStartPosition().getLineAndCharacter().line,
        end_line: failure.getEndPosition().getLineAndCharacter().line,
        annotation_level: level as LEVEL,
        message: `${failure.getRuleName()}: ${failure.getFailure()}`,
      }
    })

    if (annotations.length > 50) annotations.length = 50 // checks limit: 50

    await gitToolkit.checks.create({
      owner,
      repo,
      head_sha,
      name: 'Linter',
      status: 'completed',
      conclusion: lintResult.errorCount ? CONCLUSION.FAILURE : CONCLUSION.SUCCESS,
      output: {
        title: 'Tslint Check Results',
        summary: `${lintResult.errorCount} errors\n${lintResult.warningCount} warnings`,
        annotations,
      },
    })
  } catch (err) {
    core.setFailed(`Action failed with error ${err}`)
  }
}

main()
