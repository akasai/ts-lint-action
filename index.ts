import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Octokit from '@octokit/rest'
import * as fs from 'fs'
import * as glob from 'glob'
import { Configuration, Linter } from 'tslint'

type LEVEL = 'notice' | 'warning' | 'failure'

enum CONCLUSION {
  FAILURE = 'failure',
  SUCCESS = 'success'
}

const main = async () => {
  const { repo: { owner, repo }, sha: head_sha } = github.context

  try {
    const lintFile = core.getInput('lintFile', { required: true }) // lintFile
    const pattern = core.getInput('pattern', { required: true }) // file pattern
    const token = core.getInput('token', { required: true }) // github token
    const strict = core.getInput('strict') // TODO: check strict
    
    const linter = new Linter({ fix: false, formatter: 'json' })

    const fileList = glob.sync(pattern, { dot: true, ignore: ['./node_modules/**'] })
    fileList.forEach((file) => {
      const inFileContents = fs.readFileSync(file, 'utf8')
      const configuration = Configuration.findConfiguration(lintFile, file).results
      linter.lint(file, inFileContents, configuration)
    })
console.log('### 123', 123)
    const lintResult = linter.getResult()
console.log('### lintResult', lintResult)
    const gitToolkit: Octokit = new github.GitHub(token)
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
