export const detectEdiType = (fileName, content) => {
  const upper = `${fileName} ${content}`.toUpperCase();
  if (content.startsWith('%PDF')) return 'pdf';
  if (fileName.toLowerCase().endsWith('.csv')) return 'csv';
  if (upper.includes('835') || upper.includes('BPR') || upper.includes('CLP')) return '835';
  if (upper.includes('277') || upper.includes('STC')) return '277CA';
  if (upper.includes('999')) return '999';
  return 'unknown';
};

export const parseX12 = (type, content) => {
  if (type === '835') return parse835(content);
  if (type === '277CA') return parse277(content);
  if (type === '999') return [];
  return [];
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

export const parseCsvWorkqueue = (content) => {
  const [headerLine, ...rows] = content.split('\n').filter(Boolean);
  if (!headerLine) return [];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  return rows.map((row) => {
    const values = row.split(',').map((v) => v.trim());
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx];
    });
    return {
      externalId: record.claim_id || record.external_id || record.patient_control_number || record.id,
      denialCode: record.denial_code || 'CO-16',
      denialReason: record.denial_reason || record.reason || 'Falta información',
      amount: Number(record.amount || record.denied_amount || 0),
      payer: record.payer || 'Blue Cross',
    };
  });
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
    amount: row.charged || row.amount || 1200,
    status: type === '835' ? 'paid' : 'pending',
    updatedAt: new Date().toISOString(),
    payerClaimNumber: row.payerClaimNumber || null,
    trackingNumber: row.trackingNumber || null,
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
