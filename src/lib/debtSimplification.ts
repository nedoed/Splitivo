import { Debt } from '../types';

/**
 * Vereinfacht eine Liste von Schulden auf die minimale Anzahl Transaktionen.
 *
 * Algorithmus: Greedy-Matching zwischen Schuldnern und Gläubigern
 *   1. Berechne Netto-Balance jeder Person (negativ = schuldet, positiv = bekommt)
 *   2. Sortiere Schuldner und Gläubiger nach Betrag (absteigend)
 *   3. Matche jeweils den größten Schuldner mit dem größten Gläubiger
 *
 * Läuft pro Währung, damit CHF- und EUR-Schulden nie vermischt werden.
 */
export const simplifyDebts = (debts: Debt[]): Debt[] => {
  if (debts.length === 0) return [];

  const currencies = [...new Set(debts.map((d) => d.currency))];
  return currencies.flatMap((cur) =>
    simplifyByCurrency(debts.filter((d) => d.currency === cur))
  );
};

const simplifyByCurrency = (debts: Debt[]): Debt[] => {
  if (debts.length === 0) return [];

  // Aufbau Profil-Map für spätere Zuweisung
  const profileMap: Record<string, any> = {};
  debts.forEach((d) => {
    if (d.from_profile) profileMap[d.from_user_id] = d.from_profile;
    if (d.to_profile)   profileMap[d.to_user_id]   = d.to_profile;
  });

  // Netto-Balance berechnen
  const balances: Record<string, number> = {};
  debts.forEach((d) => {
    balances[d.from_user_id] = (balances[d.from_user_id] ?? 0) - d.amount;
    balances[d.to_user_id]   = (balances[d.to_user_id]   ?? 0) + d.amount;
  });

  const currency = debts[0].currency;

  // Schuldner (balance < 0) und Gläubiger (balance > 0) trennen
  const debtors = Object.entries(balances)
    .filter(([, b]) => b < -0.005)
    .map(([id, b]) => ({ id, amount: parseFloat((-b).toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = Object.entries(balances)
    .filter(([, b]) => b > 0.005)
    .map(([id, b]) => ({ id, amount: parseFloat(b.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount);

  const result: Debt[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    const rounded = Math.round(pay * 100) / 100;

    if (rounded >= 0.01) {
      result.push({
        from_user_id: debtors[i].id,
        to_user_id:   creditors[j].id,
        amount:       rounded,
        currency,
        from_profile: profileMap[debtors[i].id],
        to_profile:   profileMap[creditors[j].id],
      });
    }

    debtors[i].amount   = parseFloat((debtors[i].amount   - pay).toFixed(2));
    creditors[j].amount = parseFloat((creditors[j].amount - pay).toFixed(2));

    if (debtors[i].amount   < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return result;
};

/** Gibt an wie viele Transaktionen durch Vereinfachung gespart werden */
export const countSavings = (
  original: Debt[],
  simplified: Debt[]
): number => Math.max(0, original.length - simplified.length);
