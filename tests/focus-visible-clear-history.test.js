import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, '../extension/popup/popup.css'), 'utf8');

describe('Clear history button :focus-visible accessibility', () => {
  it('defines a :focus-visible rule for .pm-btn-clear', () => {
    assert.ok(
      css.includes('.pm-btn-clear:focus-visible'),
      '.pm-btn-clear:focus-visible selector must be present in popup.css'
    );
  });

  it('sets a 3px solid #6366f1 outline', () => {
    // Extract the :focus-visible block to avoid matching other rules
    const blockStart = css.indexOf('.pm-btn-clear:focus-visible');
    assert.ok(blockStart !== -1, ':focus-visible rule must exist');
    const blockEnd = css.indexOf('}', blockStart);
    const block = css.slice(blockStart, blockEnd + 1);

    assert.ok(
      block.includes('outline') && block.includes('3px') && block.includes('solid') && block.includes('#6366f1'),
      'outline must be "3px solid #6366f1" within the :focus-visible block'
    );
  });

  it('sets outline-offset of 2px', () => {
    const blockStart = css.indexOf('.pm-btn-clear:focus-visible');
    const blockEnd = css.indexOf('}', blockStart);
    const block = css.slice(blockStart, blockEnd + 1);

    assert.ok(
      block.includes('outline-offset') && block.includes('2px'),
      'outline-offset must be "2px" within the :focus-visible block'
    );
  });

  it('hover rule does not define an outline (no focus ring on mouse hover)', () => {
    const hoverStart = css.indexOf('.pm-btn-clear:hover');
    assert.ok(hoverStart !== -1, '.pm-btn-clear:hover rule must exist');
    const hoverEnd = css.indexOf('}', hoverStart);
    const hoverBlock = css.slice(hoverStart, hoverEnd + 1);

    assert.ok(
      !hoverBlock.includes('outline'),
      ':hover block must not contain an outline declaration'
    );
  });
});
