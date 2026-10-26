/**
 * Límite negativo (SPEC-07): `disponible_total − nueva_solicitud ≥ −negativeLimit`.
 * `availableUnits` ya descuenta lo reservado por solicitudes pendientes.
 */
export function checkNegativeLimit(input: {
  availableUnits: number;
  requestUnits: number;
  negativeLimitUnits: number;
}): { ok: boolean; resultingUnits: number; negative: boolean } {
  const resultingUnits = input.availableUnits - input.requestUnits;
  return {
    ok: resultingUnits >= -input.negativeLimitUnits,
    resultingUnits,
    negative: resultingUnits < 0,
  };
}
