import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectArg, resolveProjectRoot, resolveWorkspace, resolveWorkspacePath} from './workspace.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workspace-test-'));
  const engine = join(root, 'engine');
  const project = join(root, 'product');
  mkdirSync(join(engine, '.git'), {recursive: true});
  mkdirSync(join(project, '.git'), {recursive: true});
  return {root, engine, project};
}

test('projectArg accepts separated and equals forms', () => {
  assert.equal(projectArg(['brand', '--project', 'C:/work/product']), 'C:/work/product');
  assert.equal(projectArg(['brand', '--project=C:/work/product']), 'C:/work/product');
});

test('projectArg rejects a missing project value', () => {
  assert.throws(() => projectArg(['brand', '--project']), /requires a product repository path/);
  assert.throws(() => projectArg(['brand', '--project=']), /requires a product repository path/);
  assert.throws(() => projectArg(['brand', '--project', '--dry-run']), /requires a product repository path/);
  assert.equal(projectArg(['brand', '--dry-run']), null);
});

test('malformed explicit project cannot fall back to legacy metadata', () => {
  const f = fixture();
  const metadata = join(f.root, 'run.json');
  try {
    writeFileSync(metadata, JSON.stringify({productRepo: f.project}));
    assert.throws(
      () => resolveWorkspace(f.engine, {brand: 'example', project: projectArg(['--project', '--dry-run']), cwd: f.engine, metadataCandidates: [metadata]}),
      /requires a product repository path/,
    );
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveWorkspace keeps every generated artifact under the product repository', () => {
  const f = fixture();
  try {
    const workspace = resolveWorkspace(f.engine, {brand: 'example', project: f.project});
    assert.equal(workspace.projectRoot, f.project);
    assert.equal(workspace.engineRoot, f.engine);
    assert.equal(workspace.outRoot, join(f.project, 'marketing', 'assets'));
    assert.equal(workspace.brandRoot, join(f.project, 'marketing', 'assets', 'example'));
    assert.equal(workspace.marketingDir, join(workspace.brandRoot, 'marketing'));
    assert.equal(workspace.matrixDir, join(workspace.brandRoot, 'matrix'));
    assert.equal(workspace.postkitDir, join(workspace.brandRoot, 'postkit'));
    assert.equal(workspace.publicDir, join(workspace.brandRoot, 'public'));
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveWorkspace infers the calling product git worktree but never the engine', () => {
  const f = fixture();
  try {
    assert.equal(resolveWorkspace(f.engine, {brand: 'example', cwd: join(f.project, 'src')}).projectRoot, f.project);
    assert.throws(() => resolveWorkspace(f.engine, {brand: 'example', cwd: f.engine}), /--project/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveWorkspace rejects brand traversal and nested engine/product roots', () => {
  const f = fixture();
  try {
    assert.throws(() => resolveWorkspace(f.engine, {brand: '../outside', project: f.project}), /safe slug/);
    mkdirSync(join(f.root, '.git'));
    assert.throws(() => resolveWorkspace(f.engine, {brand: 'example', project: f.root}), /outside the animation engine/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveProjectRoot accepts only existing external repos from legacy metadata', () => {
  const f = fixture();
  const metadata = join(f.root, 'run.json');
  try {
    writeFileSync(metadata, JSON.stringify({run: {productRepo: f.project}}));
    assert.deepEqual(resolveProjectRoot(f.engine, {brand: 'example', cwd: f.engine, metadataCandidates: [metadata]}), {
      projectRoot: f.project,
      projectSource: 'legacy product metadata',
    });
    writeFileSync(metadata, JSON.stringify({productRepo: f.engine}));
    assert.throws(
      () => resolveProjectRoot(f.engine, {brand: 'example', cwd: f.engine, metadataCandidates: [metadata]}),
      /outside the animation engine/,
    );
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveWorkspacePath accepts only paths under the product repository', () => {
  const f = fixture();
  try {
    const workspace = resolveWorkspace(f.engine, {brand: 'example', project: f.project});
    assert.equal(resolveWorkspacePath(workspace, 'marketing/assets/example/marketing/run.json'), join(workspace.projectRoot, 'marketing', 'assets', 'example', 'marketing', 'run.json'));
    assert.throws(() => resolveWorkspacePath(workspace, join(f.root, 'outside', 'run.json')), /escapes/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveWorkspacePath rejects a junction that escapes the product repository', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  const link = join(f.project, 'linked-outside');
  try {
    try {
      symlinkSync(outside, link, 'junction');
    } catch (error) {
      t.skip(`junction unavailable: ${error.code}`);
      return;
    }
    const workspace = resolveWorkspace(f.engine, {brand: 'example', project: f.project});
    assert.throws(() => resolveWorkspacePath(workspace, 'linked-outside/new.json'), /escapes/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveWorkspace rejects an existing marketing junction outside the product repo', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  try {
    try {
      symlinkSync(outside, join(f.project, 'marketing'), 'junction');
    } catch (error) {
      t.skip(`junction unavailable: ${error.code}`);
      return;
    }
    assert.throws(() => resolveWorkspace(f.engine, {brand: 'example', project: f.project}), /escapes product repository/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('resolveWorkspace rejects descendant junctions inside the generated brand tree', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside');
  const publicDir = join(f.project, 'marketing', 'assets', 'example', 'public');
  mkdirSync(outside);
  mkdirSync(publicDir, {recursive: true});
  try {
    try {
      symlinkSync(outside, join(publicDir, 'linked'), 'junction');
    } catch (error) {
      t.skip(`junction unavailable: ${error.code}`);
      return;
    }
    assert.throws(() => resolveWorkspace(f.engine, {brand: 'example', project: f.project}), /symbolic link or junction/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});
