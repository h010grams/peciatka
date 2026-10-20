import { describe, expect, it } from 'vitest';
import {
  applyRedeem,
  applyRevoke,
  applyStamp,
  canRevoke,
  DomainError,
  nextStampAllowedAt,
} from '../src/domain/stamping.js';

const H = 3600 * 1000;
const t0 = new Date('2026-10-07T10:00:00Z');
const at = (hours: number) => new Date(t0.getTime() + hours * H);

describe('cooldown', () => {
  it('allows the first stamp', () => {
    expect(nextStampAllowedAt(null, 12, t0)).toBeNull();
  });
  it('blocks within the window and reports when it opens', () => {
    expect(nextStampAllowedAt(t0, 12, at(11.9))).toEqual(at(12));
  });
  it('allows exactly at the window end and after', () => {
    expect(nextStampAllowedAt(t0, 12, at(12))).toBeNull();
    expect(nextStampAllowedAt(t0, 12, at(30))).toBeNull();
  });
  it('cooldown 0 disables the limit', () => {
    expect(nextStampAllowedAt(t0, 0, t0)).toBeNull();
  });
});

describe('applyStamp', () => {
  const zero = { stampCount: 0, rewardsAvailable: 0, totalVisits: 0 };

  it('increments counters', () => {
    const r = applyStamp(zero, 10);
    expect(r).toEqual({ counters: { stampCount: 1, rewardsAvailable: 0, totalVisits: 1 }, rewardEarned: false });
  });

  it('earns a reward on the N-th stamp and starts a new cycle', () => {
    const r = applyStamp({ stampCount: 9, rewardsAvailable: 0, totalVisits: 9 }, 10);
    expect(r).toEqual({ counters: { stampCount: 0, rewardsAvailable: 1, totalVisits: 10 }, rewardEarned: true });
  });

  it('rewards accumulate', () => {
    let c = zero;
    let earned = 0;
    for (let i = 0; i < 25; i++) {
      const r = applyStamp(c, 10);
      c = r.counters;
      if (r.rewardEarned) earned++;
    }
    expect(earned).toBe(2);
    expect(c).toEqual({ stampCount: 5, rewardsAvailable: 2, totalVisits: 25 });
  });

  it('if N was lowered below current count, next stamp earns the reward', () => {
    const r = applyStamp({ stampCount: 8, rewardsAvailable: 0, totalVisits: 8 }, 5);
    expect(r.rewardEarned).toBe(true);
    expect(r.counters.stampCount).toBe(0);
  });
});

describe('applyRedeem', () => {
  it('decrements available rewards, keeps stamps', () => {
    expect(applyRedeem({ stampCount: 3, rewardsAvailable: 2, totalVisits: 23 })).toEqual({
      stampCount: 3,
      rewardsAvailable: 1,
      totalVisits: 23,
    });
  });
  it('fails without a reward', () => {
    expect(() => applyRedeem({ stampCount: 9, rewardsAvailable: 0, totalVisits: 9 })).toThrowError(
      new DomainError('no_reward'),
    );
  });
});

describe('applyRevoke', () => {
  it('removes a regular stamp', () => {
    expect(applyRevoke({ stampCount: 4, rewardsAvailable: 0, totalVisits: 4 }, 10, null)).toEqual({
      stampCount: 3,
      rewardsAvailable: 0,
      totalVisits: 3,
    });
  });

  it('revoking the reward-earning stamp voids the reward and restores N-1', () => {
    expect(
      applyRevoke({ stampCount: 0, rewardsAvailable: 1, totalVisits: 10 }, 10, { status: 'AVAILABLE' }),
    ).toEqual({ stampCount: 9, rewardsAvailable: 0, totalVisits: 9 });
  });

  it('cannot revoke when the earned reward was already redeemed', () => {
    expect(() =>
      applyRevoke({ stampCount: 0, rewardsAvailable: 0, totalVisits: 10 }, 10, { status: 'REDEEMED' }),
    ).toThrowError(new DomainError('reward_already_redeemed'));
  });

  it('never goes negative', () => {
    expect(applyRevoke({ stampCount: 0, rewardsAvailable: 0, totalVisits: 0 }, 10, null)).toEqual({
      stampCount: 0,
      rewardsAvailable: 0,
      totalVisits: 0,
    });
  });
});

describe('revoke window', () => {
  it('is 24 hours', () => {
    expect(canRevoke(t0, at(23.9))).toBe(true);
    expect(canRevoke(t0, at(24.1))).toBe(false);
  });
});
