// A flat-rate estimate, not an EIR/reducing-balance or early-settlement calculator.
export function calculateCarLoan({price,deposit,rate,years}) {
  if (![price,deposit,rate,years].every(Number.isFinite)) throw new RangeError('number');
  if (price <= 0 || price > 10000000) throw new RangeError('price');
  if (deposit < 0 || deposit > price) throw new RangeError('deposit');
  if (rate < 0 || rate > 30) throw new RangeError('rate');
  if (!Number.isInteger(years) || years < 1 || years > 9) throw new RangeError('years');
  const principal = price - deposit, months = years * 12;
  const interest = principal * rate / 100 * years;
  const repayment = principal + interest;
  // Keep full precision until display; a lender may adjust the final instalment.
  return {principal,months,interest,repayment,monthly:repayment/months,total:deposit+repayment};
}
