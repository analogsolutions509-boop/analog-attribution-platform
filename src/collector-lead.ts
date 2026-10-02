export type RawFormFields = Record<string, unknown>;

const clean = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v ? v.slice(0, 1000) : undefined;
};

function pick(fields: RawFormFields, names: string[]): string | undefined {
  for (const key of Object.keys(fields)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (names.includes(normalized)) return clean(fields[key]);
  }
  return undefined;
}

export function extractLeadPayload(fields: RawFormFields): Record<string, unknown> | null {
  const phone = pick(fields, ["phone","phonenumber","mobile","mobilenumber","telephone","tel","yourphone","formfieldsphone"]);
  const email = pick(fields, ["email","emailaddress","youremail","formfieldsemail"]);
  const name = pick(fields, ["name","fullname","yourname","customername","contactname","formfieldsname"]);
  const company = pick(fields, ["company","companyname","business","businessname","formfieldscompany"]);
  const message = pick(fields, ["message","details","enquiry","inquiry","requirements","description","yourmessage","formfieldsmessage"]);
  const service = pick(fields, ["service","servicetype","serviceType","projecttype","typeofservice","formfieldsservice"]);
  if (!phone && !email) return null;
  return {
    ...(name ? { name } : {}),
    ...(company ? { company_name: company } : {}),
    ...(phone ? { phone, customer_phone: phone } : {}),
    ...(email ? { email, customer_email: email } : {}),
    ...(service ? { service_type: service } : {}),
    ...(message ? { message } : {})
  };
}

export function shouldAutoCaptureForm(fields: RawFormFields): boolean {
  return extractLeadPayload(fields) !== null;
}
