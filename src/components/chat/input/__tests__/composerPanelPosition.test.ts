import { describe, expect, it } from 'vitest';
import { composerPanelPosition } from '../panel-styles';

describe('composer panel placement', () => {
  it('opens above a bottom-docked composer as before', () => {
    expect(
      composerPanelPosition(
        { left: 240, width: 600, top: 590, bottom: 650 },
        1000,
        720,
        440,
      ),
    ).toEqual({ left: 320, width: 440, bottom: 138, maxHeight: 574 });
  });

  it('opens below the centered composer when there is more room there', () => {
    expect(
      composerPanelPosition(
        { left: 160, width: 540, top: 190, bottom: 245 },
        900,
        580,
        440,
      ),
    ).toEqual({ left: 210, width: 440, top: 253, maxHeight: 319 });
  });

  it('fits a narrow viewport without shrinking below the anchor gap', () => {
    expect(
      composerPanelPosition(
        { left: 12, width: 300, top: 215, bottom: 280 },
        320,
        500,
        440,
      ),
    ).toEqual({ left: 8, width: 304, top: 288, maxHeight: 204 });
  });
});
