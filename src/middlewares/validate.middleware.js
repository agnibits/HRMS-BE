/**
 * Zod validation middleware. Validates and *replaces* req.body/query/params with
 * the parsed (coerced, stripped) output so controllers work with clean data.
 *
 * Usage:
 *   router.post('/', validate({ body: createUserSchema }), controller.create)
 */
export function validate(schemas = {}) {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      next(err); // ZodError -> normalized by the central error handler
    }
  };
}

export default validate;
