const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };

export const callIntelligenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary","customer_name","company_name","customer_email","customer_phone",
    "intent","lead_type","buying_stage","urgency","sentiment","outcome","next_action",
    "objections","questions","commitments","topics","construction_requirements",
    "confidence","extracted_fields"
  ],
  properties: {
    summary: nullableString,
    customer_name: nullableString,
    company_name: nullableString,
    customer_email: nullableString,
    customer_phone: nullableString,
    intent: nullableString,
    lead_type: nullableString,
    buying_stage: nullableString,
    urgency: nullableString,
    sentiment: nullableString,
    outcome: nullableString,
    next_action: nullableString,
    objections: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    commitments: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    construction_requirements: {
      type: "object",
      additionalProperties: false,
      required: [
        "service","product","quantity","unit","grade_or_specification",
        "delivery_location","delivery_date","delivery_time","application",
        "equipment_or_pump","access_constraints","other_requirements"
      ],
      properties: {
        service: nullableString,
        product: nullableString,
        quantity: nullableNumber,
        unit: nullableString,
        grade_or_specification: nullableString,
        delivery_location: nullableString,
        delivery_date: nullableString,
        delivery_time: nullableString,
        application: nullableString,
        equipment_or_pump: nullableString,
        access_constraints: nullableString,
        other_requirements: { type: "array", items: { type: "string" } }
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    extracted_fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "field_key","field_group","normalized_value","display_value","confidence",
          "evidence_start_seconds","evidence_end_seconds","evidence_text","source_type"
        ],
        properties: {
          field_key: { type: "string" },
          field_group: { type: "string" },
          normalized_value: nullableString,
          display_value: nullableString,
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence_start_seconds: nullableNumber,
          evidence_end_seconds: nullableNumber,
          evidence_text: nullableString,
          source_type: { type: "string" }
        }
      }
    }
  }
};
