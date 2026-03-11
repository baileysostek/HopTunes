/**
 * To handle the edge case where chance is 0 or very close to it,
 * we should return Infinity or a very large number.
 * @param chance 
 * @returns 
 */
export const determineOdds = (chance: number): number => {
  if (chance <= 0) {
    return Infinity;
  }
  return Math.round(1.0 / chance);
};