export const detectEdiType = (fileName, content) => {
  const upper = `${fileName} ${content}`.toUpperCase();
  if (upper.includes('835') || upper.includes('BPR') || upper.includes('CLP')) return '835';
  if (upper.includes('277') || upper.includes('STC')) return '277CA';
  return 'unknown';
};

export const parse835 = (content) => {
  const claimsParsed = [];
  const regex = /CLP\*([^*]+)\*[^*]*\*([0-9.]+)\*([0-9.]+)\*([0-9.]+)\*/g;
  let match = regex.exec(content);
  while (match) {
    const [_, externalId, charged, paid, patientResp] = match;
    claimsParsed.push({
      externalId,
      charged: Number(charged),
      paid: Number(paid),
      patientResp: Number(patientResp),
      status: 'paid',
    });
    match = regex.exec(content);
  }
  return claimsParsed;
};

export const parse277 = (content) => {
  const claimsParsed = [];
  const regex = /TRN\*1\*([^~*\n\r]+)[^~]*~?[^~]*STC\*([^*~]+)/g;
  let match = regex.exec(content);
  while (match) {
    const [_, externalId, status] = match;
    claimsParsed.push({
      externalId,
      status,
      denialCode: status.includes('CO') ? status.split(':')[1] || 'CO-16' : 'CO-16',
      denialReason: 'Falta información',
    });
    match = regex.exec(content);
  }
  return claimsParsed;
};

export const normalizeClaimEvent = (row, type) => {
  const baseClaim = {
    externalId: row.externalId,
    patientName: 'Paciente Demo',
    payer: 'Blue Cross',
    amount: row.charged || 1200,
    status: type === '835' ? 'paid' : 'pending',
    updatedAt: new Date().toISOString(),
  };

  const denial = type === '277CA'
    ? {
        denialCode: row.denialCode || 'CO-16',
        denialReason: row.denialReason || 'Falta información',
        deniedAt: new Date().toISOString(),
        status: 'open',
      }
    : null;

  const payment = type === '835'
    ? {
        paidAmount: row.paid || 0,
        chargedAmount: row.charged || 0,
        patientResponsibility: row.patientResp || 0,
        paidAt: new Date().toISOString(),
      }
    : null;

  return { claim: baseClaim, denial, payment };
};
