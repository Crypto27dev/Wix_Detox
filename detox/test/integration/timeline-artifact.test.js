const path = require('path');

const _ = require('lodash');
const tempfile = require('tempfile');
const fs = require('fs-extra');
const { promisify } = require('util');
const { execCommand } = require('./utils/exec');

const TMPDIR = path.dirname(tempfile());
const readFile = promisify(fs.readFile);
const remove = promisify(fs.remove);

describe('Timeline integration test', () => {
  const artifactsDirectory = 'integration_artifacts/'
  const timelineArtifactFilename = 'detox.trace.json';
  const timelineArtifactPath = path.join(artifactsDirectory, timelineArtifactFilename);
  const clearAllArtifacts = () => remove(artifactsDirectory);

  let tac;

  beforeAll(clearAllArtifacts);

  beforeAll(async () => {
    await execCommand(`detox test -c stub --config integration/e2e/config.js -a ${artifactsDirectory} -R 1 stub1`);
    tac = JSON.parse(await readFile(timelineArtifactPath, 'utf8'));
  });

  it('should deterministically produce a timeline artifact', async () => {
    const sanitizeContext = { pid: new Map(), sessionId: '', cwd: '' };
    expect(tac.filter(isLifecycleEvent).map(sanitizeEvent, sanitizeContext)).toMatchSnapshot();
  });

  it('should have a credible list of categories', async () => {
    const cats = _.chain(tac)
      .flatMap(e => e.cat ? `${e.cat}`.split(',') : [])
      .uniq()
      .sort()
      .value();

    expect(cats).toEqual([
      'artifact',
      'artifacts-manager',
      'cli',
      'device',
      'ipc',
      'ipc-server',
      'jest-environment',
      'lifecycle',
      'user',
      'ws',
      'ws-client',
      'ws-server',
      'ws-session'
    ]);
  });

  it('should have a credible process and thread ids', async () => {
    const unique = _.mapValues({
      pid: tac.map(e => e.pid),
      tid: tac.map(e => e.tid),
      pid_tid: tac.map(e => `${e.pid}:${e.tid}`),
    }, v => _.uniq(v).sort());

    expect(unique.pid.length).toBe(3);
    expect(unique.tid.length).toBeLessThan(unique.pid_tid.length);
    expect(unique.pid_tid.length).toBeGreaterThan(10);
  });
});

function isLifecycleEvent(e) {
  return `${e.cat}`.split(',').includes('lifecycle');
}

/** @this {{ pid: Map; sessionId: string; cwd: string; }} */
function sanitizeEvent(e, ts) {
  const r = { ...e };
  r.args = { ...r.args };

  if (ts === 0) {
    this.sessionId = r.args.data.id;
    this.cwd = r.args.cwd;

  }

  r.pid = (this.pid.has(e.pid) ? this.pid : this.pid.set(e.pid, this.pid.size)).get(e.pid);
  r.ts = ts;

  if (r.name) {
    r.name = r.name
      .replace(TMPDIR, '$TMPDIR')
      .replace(this.sessionId, '$SESSION_ID')
      .replace(this.cwd, '$CWD');
  }

  if (r.args.cwd) {
    r.args.cwd = '$CWD';
  }

  if (typeof r.args.error === 'string') {
    r.args.error = r.args.error.split('\n')[0];
  }
  if (r.args.data) {
    r.args.data = {};
  }

  return r;
}
