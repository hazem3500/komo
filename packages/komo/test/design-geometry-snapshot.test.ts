// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { changePreviewStyles, inlineStyleSnapshot } from '../src/design-preview.js';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

it.each([null, 'width:100px !important;transition:opacity 2s linear !important'])('restores exact attribute through transition suppression: %s', attribute => {
  const element = document.body.appendChild(document.createElement('div'));
  if (attribute !== null) element.setAttribute('style', attribute);
  const width = inlineStyleSnapshot(element, 'width');
  const height = inlineStyleSnapshot(element, 'height');
  element.style.setProperty('width', '200px', 'important');
  element.style.height = '150px';
  changePreviewStyles(element, ['width', 'height'], () => { height.restore(); width.restore(); });
  expect(element.getAttribute('style')).toBe(attribute);
});

it('does not overwrite host writes when an animated restoration settles', () => {
  vi.useFakeTimers();
  const element = document.body.appendChild(document.createElement('div'));
  element.style.width = '100px';
  const snapshot = inlineStyleSnapshot(element, 'width');
  element.style.width = '200px';
  changePreviewStyles(element, ['width'], () => snapshot.restore(), true);
  element.style.width = '240px';
  vi.runAllTimers();
  expect(element.style.width).toBe('240px');
  expect(element.style.transition).toBe('');
});
