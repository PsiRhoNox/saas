export const runDemoTriage = (claim, denial) => {
  return {
    denial_category_normalized: denial.denialCode.startsWith('CO') ? 'coding' : 'eligibility',
    root_cause_guess: { label: denial.denialReason || 'Faltan datos', confidence: 0.6 },
    suggested_action_short: 'Adjuntar documentación faltante',
    suggested_action_steps: ['Revisar expediente', 'Adjuntar soporte', 'Reenviar al pagador'],
    required_documents: ['Notas clínicas', 'Orden médica'],
    who_should_work_it: 'RCM Specialist',
    priority_adjustment: 8,
    appeal_recommended: true,
    appeal_angle: 'Necesidad médica y documentación completa.',
    warnings: ['Campos incompletos del archivo fuente'],
  };
};
