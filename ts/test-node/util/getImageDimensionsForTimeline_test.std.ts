// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { getImageDimensionsForTimeline } from '../../util/Attachment.std.ts';
import { LARGE_IMAGE_ASPECT_RATIO_LIMITS } from '../../linkPreviews/linkCardVisual.std.ts';

// card-visual §3.2 / §3.8: the picture of a large-image card is 1.91:1 at its widest and square at
// its tallest (width ÷ height); anything outside that is cropped around the centre, which is what
// `object-fit: cover` does to a picture drawn into a box of the clamped shape. Without limits the
// function keeps the shape of the picture (upstream behaviour, used by every other attachment).

const LIMITS = LARGE_IMAGE_ASPECT_RATIO_LIMITS;

describe('getImageDimensionsForTimeline', () => {
  describe('without limits (upstream)', () => {
    it('keeps the shape of the picture between 200-300 wide and 50-450 high', () => {
      assert.deepEqual(
        getImageDimensionsForTimeline({ width: 1800, height: 300 }),
        { width: 300, height: 50 }
      );
      assert.deepEqual(
        getImageDimensionsForTimeline({ width: 600, height: 1200 }),
        { width: 300, height: 450 }
      );
      assert.deepEqual(
        getImageDimensionsForTimeline({ width: 1200, height: 630 }),
        { width: 300, height: 158 }
      );
    });

    it('falls back to 200 by 50 without a size', () => {
      assert.deepEqual(getImageDimensionsForTimeline({}), {
        width: 200,
        height: 50,
      });
    });
  });

  describe('with the large-image limits', () => {
    it('is 1.91 to 1 and 1 to 1', () => {
      assert.deepEqual(LIMITS, { min: 1, max: 1.91 });
    });

    it('crops a picture wider than 1.91:1 to 1.91:1', () => {
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 1800, height: 300 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 157 }
      );
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 1200, height: 400 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 157 }
      );
    });

    it('crops a picture taller than square to square', () => {
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 600, height: 1200 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 300 }
      );
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 900, height: 1000 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 300 }
      );
    });

    it('leaves a picture inside the range as it is', () => {
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 1200, height: 630 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 158 }
      );
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 1200, height: 800 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 200 }
      );
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 800, height: 800 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 300 }
      );
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 1910, height: 1000 },
          undefined,
          LIMITS
        ),
        { width: 300, height: 157 }
      );
    });

    it('does not change the width', () => {
      assert.strictEqual(
        getImageDimensionsForTimeline(
          { width: 250, height: 50 },
          undefined,
          LIMITS
        ).width,
        250
      );
      assert.strictEqual(
        getImageDimensionsForTimeline(
          { width: 150, height: 600 },
          undefined,
          LIMITS
        ).width,
        200
      );
      assert.strictEqual(
        getImageDimensionsForTimeline(
          { width: 4000, height: 100 },
          undefined,
          LIMITS
        ).width,
        300
      );
    });

    it('clamps the shape at a forced width too', () => {
      assert.deepEqual(
        getImageDimensionsForTimeline(
          { width: 1800, height: 300 },
          240,
          LIMITS
        ),
        { width: 240, height: 126 }
      );
    });
  });
});
