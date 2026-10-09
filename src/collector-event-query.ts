export const collectorEventQuery = `
  SELECT e.id,e.site_id,e.visitor_id,e.session_id,e.event_key,e.event_name,
         e.occurred_at,e.page_url,e.page_path,s.utm_source,s.utm_campaign,e.payload
  FROM events e
  LEFT JOIN sessions s ON s.id=e.session_id
  WHERE e.id=$1
`;
