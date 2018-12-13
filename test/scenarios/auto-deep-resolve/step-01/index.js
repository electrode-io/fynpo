/*
 * opt A:
 *   B:
 *     C
 * D:
 *   E:
 *     B:
 *       C
 *
 * Resolving A->B->C makes C known, so when it's seen thru D->E->B->C, it's not
 * resolved but used exist one directly, and C would only know about A->B->C path.
 *
 * Most of the time this is OK, but because A is optional, it could be removed
 * due to failures, and affects the DEBC path.
 *
 * So any known package that has only optional paths need to auto do deep resolve.
 */

//
// this test works by making C install fail and the outcome should fail
// instead of success without auto deep resolve because it would only see
// the A->B->C path which is optional.
//

module.exports = {
  expectFailure: err => {
    if (err.message.indexOf("exit Error") < 0) throw err;
  },
  title: "should auto deep resolve deps that has optional only"
};
