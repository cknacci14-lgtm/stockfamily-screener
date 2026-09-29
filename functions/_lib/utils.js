// ============================================================
// Utilities
// ============================================================

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store'
    }
  });
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ success: false, error: message }, status);
}
