export function errorHandler(error, _req, res, _next) {
  console.error("Request error:", error);
  const status = typeof error.status === "number" ? error.status : 500;
  res.status(status).json({
    success: false,
    error: { message: status >= 500 ? "Internal server error" : error.message },
  });
}
