// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { assert } from 'chai';
import {
  layout as bridgeLayout,
  tint as bridgeTint,
} from '@signalapp/libsignal-client/dist/links.js';

import { parseLinkCard } from '../../linkPreviews/linkCard.std.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import {
  parseLinkCardTint,
  type LinkCardLayoutType,
} from '../../linkPreviews/linkCardVisual.std.ts';
import {
  SHEET_COLORS,
  SHEET_ROWS,
  SHEET_TINTS,
  type SheetCellType,
  type SheetColorType,
  type SheetRowType,
} from '../../storybook/linkCardSheet.std.ts';

// card-visual §3.11: the acceptance sheet shows every row of the §3.7 table with "all fields" and
// "required fields only". Its card data is written out by hand, so these keep it honest against
// what is real: the registry's kinds (which fields a kind has, which are required), the card JSON
// shape of rust/links, and the two functions the sheet leaves to rust/links, `layout()` and
// `tint()`, asked through the real bridge.

const FIXTURES = join(cwd(), 'fixtures', 'links');
const golden: Readonly<{ registry: string }> = JSON.parse(
  readFileSync(join(FIXTURES, 'classify-golden.json'), 'utf8')
);

type KindType = Readonly<{
  id: string;
  attrs?: Readonly<Record<string, string>>;
  required?: ReadonlyArray<string>;
  required_any?: ReadonlyArray<ReadonlyArray<string>>;
  first_party?: boolean;
  reserved?: boolean;
}>;

const kinds: ReadonlyArray<KindType> = JSON.parse(
  readFileSync(join(FIXTURES, golden.registry), 'utf8')
).payload.kinds.kind;

type CellCaseType = Readonly<{
  name: string;
  row: SheetRowType;
  state: 'full' | 'required';
  cell: SheetCellType;
}>;

const CELLS: ReadonlyArray<CellCaseType> = SHEET_ROWS.flatMap(row => [
  { name: `${row.id} (all fields)`, row, state: 'full', cell: row.full },
  {
    name: `${row.id} (required only)`,
    row,
    state: 'required',
    cell: row.required,
  },
]);

// The 32 × 32 reduction of a flat picture: every pixel that colour.
function flatPicture(hex: string): Uint8Array<ArrayBuffer> {
  const value = parseInt(hex.slice(1), 16);
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
    rgba[pixel * 4] = Math.floor(value / 65536) % 256;
    rgba[pixel * 4 + 1] = Math.floor(value / 256) % 256;
    rgba[pixel * 4 + 2] = value % 256;
    rgba[pixel * 4 + 3] = 255;
  }
  return rgba;
}

function attrKeys(card: LinkCardType): Array<string> {
  return card.attrs.map(({ key }) => key);
}

// The first-party fields a card carries, by the names the kind uses for them.
function firstPartyFields(card: LinkCardType): Array<string> {
  const firstParty = card.first_party;
  if (!firstParty) {
    return [];
  }
  const fields: Array<string> = [];
  if (firstParty.type === 'group' && firstParty.member_count != null) {
    fields.push('member_count');
  }
  if (firstParty.type === 'sticker' && firstParty.sticker_count != null) {
    fields.push('sticker_count');
  }
  return fields;
}

describe('the link card acceptance sheet', () => {
  it('has a row for every kind of the registry (the reserved ones only show as a brand shell)', () => {
    const used = new Set(
      SHEET_ROWS.flatMap(row => [row.full, row.required]).map(
        cell => cell.preview.card?.kind
      )
    );
    for (const kind of kinds.filter(candidate => !candidate.reserved)) {
      assert.isTrue(used.has(kind.id), `no row for ${kind.id}`);
    }
    // And a brand shell with and without a bundled icon, a payment shell, a plain link, a generic
    // page and a kind this build does not know, as §3.11 asks.
    const levels = new Set(
      SHEET_ROWS.flatMap(row => [row.full, row.required]).map(
        cell => cell.preview.card?.level
      )
    );
    for (const level of [
      'plain_link',
      'generic',
      'brand',
      'structured',
      'first_party',
    ] as const) {
      assert.isTrue(levels.has(level), level);
    }
    const brands = SHEET_ROWS.flatMap(row => [row.full, row.required]).filter(
      cell => cell.preview.card?.level === 'brand'
    );
    assert.isTrue(
      brands.some(cell => cell.preview.cardIcon),
      'a brand shell with its icon'
    );
    assert.isTrue(
      brands.some(
        cell => !cell.preview.cardIcon && !cell.preview.card?.payment
      ),
      'a brand shell without one'
    );
    assert.isTrue(
      brands.some(cell => cell.preview.card?.payment),
      'a payment shell'
    );
    const known = new Set(kinds.map(kind => kind.id));
    assert.isTrue(
      SHEET_ROWS.some(row => {
        const kind = row.full.preview.card?.kind;
        return (
          row.full.preview.card?.level === 'structured' &&
          kind &&
          !known.has(kind)
        );
      }),
      'a kind this build does not know'
    );
  });

  describe('"all fields" has every field of the kind, "required only" has none of the others', () => {
    for (const { name, row, state, cell } of CELLS) {
      const card = cell.preview.card;
      const kind = kinds.find(candidate => candidate.id === card?.kind);
      if (!card || !kind || kind.reserved) {
        continue;
      }
      it(name, () => {
        const have = new Set([...attrKeys(card), ...firstPartyFields(card)]);
        const all = Object.keys(kind.attrs ?? {});
        if (state === 'full') {
          for (const key of all) {
            assert.isTrue(have.has(key), `${row.id}: ${key} is missing`);
          }
          return;
        }
        // The fields the kind requires are there (a title, a picture); a place needs its
        // coordinates or a name; nothing else is.
        const requiredAttrs = new Set(
          (kind.required_any ?? [[]]).find(group =>
            group.every(key => have.has(key))
          ) ?? []
        );
        for (const key of have) {
          assert.isTrue(
            requiredAttrs.has(key),
            `${row.id}: ${key} is not required`
          );
        }
        if (kind.required?.includes('title')) {
          assert.isTrue(
            Boolean(card.title ?? cell.preview.title) ||
              card.first_party?.type === 'group' ||
              card.first_party?.type === 'sticker',
            `${row.id}: a title is required`
          );
        }
        if (kind.required?.includes('image')) {
          assert.isDefined(
            cell.preview.image,
            `${row.id}: a picture is required`
          );
        }
        if (kind.required_any) {
          assert.isTrue(
            kind.required_any.some(group => group.every(key => have.has(key))),
            `${row.id}: what the kind requires is missing`
          );
        }
      });
    }
  });

  describe('every card is a card rust/links could have made', () => {
    for (const { name, cell } of CELLS) {
      it(name, () => {
        const { card, url } = cell.preview;
        if (!card) {
          throw new Error('no card');
        }
        // The JSON shape the native module returns, read by the same schema the app uses.
        assert.deepEqual(parseLinkCard(JSON.stringify(card)), card);
        assert.include(url, card.domain ?? '', 'the domain is in the URL');
        assert.isFalse(
          card.level === 'first_party' && card.tintable,
          'a first-party card is never tinted'
        );
        assert.isFalse(
          card.payment && card.tintable,
          'a payment shell is never tinted'
        );
      });
    }
  });

  describe('each card has the shape rust/links gives it', () => {
    for (const { name, cell } of CELLS) {
      it(name, () => {
        const { card, image, cardIcon, layout } = cell.preview;
        assert.isDefined(card);
        // The picture the shape is decided from: a brand shell's bundled icon, else the
        // sender's picture when the card shows it, else none (selector: `getPreviewsForMessage`).
        const shown = cardIcon ?? (card?.show_image ? image : undefined);
        const decided = bridgeLayout(
          shown?.width ?? 0,
          shown?.height ?? 0,
          card?.kind ?? '',
          card?.level ?? ''
        ) as LinkCardLayoutType;
        assert.strictEqual(layout, decided);
      });
    }
  });

  describe('each colour is what rust/links tint() answers', () => {
    for (const color of Object.keys(SHEET_COLORS) as Array<SheetColorType>) {
      it(color, () => {
        for (const shape of ['icon', 'large_image'] as const) {
          const answered = parseLinkCardTint(
            bridgeTint(shape, 32, 32, flatPicture(SHEET_COLORS[color]))
          );
          assert.deepEqual(answered?.tinted, SHEET_TINTS[color].tinted, shape);
          assert.deepEqual(answered?.light, SHEET_TINTS[color].light, shape);
          assert.deepEqual(answered?.dark, SHEET_TINTS[color].dark, shape);
        }
      });
    }

    it('and a card that can be tinted has the colour of the picture it draws', () => {
      for (const { name, cell } of CELLS) {
        const { card, layout } = cell.preview;
        const tintable =
          card?.tintable === true &&
          (layout === 'icon' || layout === 'large_image');
        assert.strictEqual(
          cell.pictureColor !== undefined,
          tintable,
          `${name}: a card that is tinted has a picture colour, and only that one`
        );
      }
    });
  });
});
