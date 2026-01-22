export const detectEdiType = (fileName: string, content: string) => {
  const upper = `${fileName} ${content}`.toUpperCase();
  if (fileName.toLowerCase().endsWith('.csv')) return 'csv';
  if (upper.includes('835') || upper.includes('BPR') || upper.includes('CLP')) return '835';
  if (upper.includes('277') || upper.includes('STC')) return '277CA';
  if (upper.includes('999')) return '999';
  return 'unknown';
};

export const parse835 = (content: string) => {
  const claims: Array<Record<string, any>> = [];
  const regex = /CLP\*([^*]+)\*[^*]*\*([0-9.]+)\*([0-9.]+)\*([0-9.]+)\*/g;
  let match = regex.exec(content);
  while (match) {
    const [_, externalId, charged, paid, patientResp] = match;
    claims.push({
      externalId,
      charged: Number(charged),
      paid: Number(paid),
      patientResp: Number(patientResp),
    });
    match = regex.exec(content);
  }
  return claims;
};

export const parse277 = (content: string) => {
  const claims: Array<Record<string, any>> = [];
  const regex = /TRN\*1\*([^~*\n\r]+)[^~]*~?[^~]*STC\*([^*~]+)/g;
  let match = regex.exec(content);
  while (match) {
    const [_, externalId, status] = match;
    claims.push({ externalId, status });
    match = regex.exec(content);
  }
  return claims;
};

export const parse999 = (_content: string) => {
  return [{ status: 'acknowledged' }];
};

export const parseCsvWorkqueue = (content: string) => {
  const [headerLine, ...rows] = content.split('\n').filter(Boolean);
  if (!headerLine) return [];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  return rows.map((row) => {
    const values = row.split(',').map((v) => v.trim());
    const record: Record<string, string> = {};
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
