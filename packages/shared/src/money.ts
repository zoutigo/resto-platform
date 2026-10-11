/** Montants en XAF (franc CFA), entiers, sans décimales. */
export const formatXAF = (amount: number): string =>
  `${new Intl.NumberFormat('fr-FR').format(Math.round(amount))} FCFA`;
