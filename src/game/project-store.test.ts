/**
 * Which project opens, and whether Ctrl+S may write the file back.
 *
 * The four ways the page can open differ in exactly one thing that can cost somebody their work:
 * whether a save goes over the file. A file that would not load must never be saved over with the
 * demo that stood in for it, so that case is pinned here alongside the three ordinary ones.
 */

import { describe, it, expect } from 'vitest';
import { buildDemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { bootDemo, bootMode, saveDefault, savesToDefault } from './project-store';

/** A response as a server would send it. No content means no body: `Response` refuses a 204 that has one. */
const answer = (status: number, body = ''): Promise<Response> => Promise.resolve(new Response(status === 204 || status === 404 ? null : body, { status }));
const demoText = JSON.stringify(buildDemoScene(hollowVaultMap()).project);

describe('which project opens', () => {
  it('opens the file when it is there and loads', async () => {
    // Renamed, so what opened is visibly the file and not the demo built from code.
    const project = JSON.parse(demoText);
    project.name = 'From the file';
    const booted = await bootDemo({ boot: 'file', search: '', fetcher: () => answer(200, JSON.stringify(project)) });
    expect(booted.source).toBe('file');
    expect(booted.problem).toBeNull();
    expect(booted.demo.project.name).toBe('From the file');
  });

  it('opens the demo from code when there is no file yet, and says nothing is wrong', async () => {
    const booted = await bootDemo({ boot: 'file', search: '', fetcher: () => answer(404) });
    expect(booted.source).toBe('missing');
    expect(booted.problem).toBeNull();
    expect(booted.demo.party.members().length).toBe(6);
  });

  it('opens the demo from code when the file will not load, and reports why', async () => {
    const problems: string[] = [];
    const bad = await bootDemo({ boot: 'file', search: '', problems, fetcher: () => answer(200, '{"id":"x"}') });
    expect(bad.source).toBe('invalid');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('left as it is');

    const garbled = await bootDemo({ boot: 'file', search: '', fetcher: () => answer(200, 'not json at all') });
    expect(garbled.source).toBe('invalid');
    const broken = await bootDemo({ boot: 'file', search: '', fetcher: () => Promise.reject(new Error('offline')) });
    expect(broken.source).toBe('invalid');
    expect(broken.problem).toContain('offline');
  });

  it('never asks for the file when the demo from code was asked for', async () => {
    let asked = 0;
    const booted = await bootDemo({ boot: 'builtin', search: '', fetcher: () => { asked++; return answer(200, demoText); } });
    expect(booted.source).toBe('builtin');
    expect(asked).toBe(0);
  });

  it('lets the address override how the server was started, either way', () => {
    expect(bootMode('?boot=builtin', 'file')).toBe('builtin');
    expect(bootMode('?boot=file', 'builtin')).toBe('file');
    expect(bootMode('', 'builtin')).toBe('builtin');
    expect(bootMode('?boot=nonsense', 'file')).toBe('file');
  });
});

describe('whether a save goes over the file', () => {
  it('does when the page opened on the file, or where the file is going to be', () => {
    expect(savesToDefault('file', true)).toBe(true);
    expect(savesToDefault('missing', true)).toBe(true);
  });

  it('never goes over a file that would not load, which may be a great deal of work with one bad field', () => {
    expect(savesToDefault('invalid', true)).toBe(false);
  });

  it('never when the demo from code was asked for, or the server does not save', () => {
    expect(savesToDefault('builtin', true)).toBe(false);
    expect(savesToDefault('file', false)).toBe(false);
  });

  it('sends the header that tells the page own save from a forgery, and says when nobody wrote it', async () => {
    let seen: RequestInit | undefined;
    const written = await saveDefault('{}', (_url, init) => { seen = init; return answer(204); });
    expect(written).toBe('written');
    expect(seen?.method).toBe('POST');
    expect((seen?.headers as Record<string, string>)['x-tactical-save']).toBe('1');

    expect(await saveDefault('{}', () => answer(403))).toBe('unavailable');
    expect(await saveDefault('{}', () => answer(404))).toBe('unavailable');
    expect(await saveDefault('{}', () => Promise.reject(new Error('no server')))).toBe('unavailable');
  });
});
