import swaggerJSDoc from 'swagger-jsdoc';
import { config } from './env.js';

/**
 * OpenAPI 3 spec assembled from JSDoc `@openapi` annotations across the module
 * route files, plus the reusable schemas / responses / parameters defined here.
 * Served as interactive docs at `${API_PREFIX}/docs` and raw JSON at
 * `${API_PREFIX}/docs.json` when ENABLE_SWAGGER=true.
 */
export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: `${config.appName} API`,
      version: '1.0.0',
      description:
        'Enterprise HRMS backend REST API.\n\n' +
        '**Auth:** obtain a token via `POST /auth/login`, then click **Authorize** and paste the ' +
        '`accessToken`. All endpoints except the public auth routes require a Bearer token.\n\n' +
        '**Conventions:** list endpoints accept `page`, `limit`, `sort` (e.g. `-createdAt,name`), ' +
        '`search`, and per-module filters. Every response uses a uniform envelope.',
    },
    servers: [
      { url: `${config.appUrl}${config.apiPrefix}`, description: config.env },
      { url: `http://localhost:${config.port}${config.apiPrefix}`, description: 'local' },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication, sessions, MFA & device management' },
      { name: 'Users', description: 'User management (admin) & self-service profile' },
      { name: 'Roles', description: 'Role-based access control — roles & permission catalog' },
      { name: 'Audit', description: 'Immutable audit trail (read-only)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      // ── Reusable schemas ────────────────────────────────────────────
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Validation failed' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { field: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
            requestId: { type: 'string', format: 'uuid' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Success' },
            data: { type: 'object', nullable: true },
            requestId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 137 },
            totalPages: { type: 'integer', example: 7 },
            hasNextPage: { type: 'boolean' },
            hasPrevPage: { type: 'boolean' },
          },
        },
        Role: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'ckv...' },
            name: { type: 'string', example: 'HR' },
            description: { type: 'string', nullable: true },
            companyId: { type: 'string', nullable: true },
            permissions: { type: 'array', items: { type: 'string', example: 'user:read' } },
            isSystem: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        RoleSummary: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string', example: 'ADMIN' } },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email', example: 'jane.doe@hrms.local' },
            firstName: { type: 'string', example: 'Jane' },
            lastName: { type: 'string', example: 'Doe' },
            phone: { type: 'string', nullable: true },
            avatarUrl: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'] },
            companyId: { type: 'string', nullable: true },
            emailVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
            mfaEnabled: { type: 'boolean' },
            lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
            roles: { type: 'array', items: { $ref: '#/components/schemas/RoleSummary' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AuthUser: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            status: { type: 'string' },
            companyId: { type: 'string', nullable: true },
            emailVerified: { type: 'boolean' },
            mfaEnabled: { type: 'boolean' },
            roles: { type: 'array', items: { type: 'string', example: 'ADMIN' } },
            permissions: { type: 'array', items: { type: 'string', example: 'user:read' } },
          },
        },
        AuthTokens: {
          type: 'object',
          properties: {
            accessToken: { type: 'string', example: 'eyJhbGciOiJI...' },
            refreshToken: { type: 'string', example: 'eyJhbGciOiJI...' },
            expiresIn: { type: 'integer', example: 900, description: 'Access token TTL in seconds' },
            sessionId: { type: 'string' },
            user: { $ref: '#/components/schemas/AuthUser' },
          },
        },
        MfaChallenge: {
          type: 'object',
          properties: {
            mfaRequired: { type: 'boolean', example: true },
            mfaToken: { type: 'string', description: 'Short-lived token to pass to /auth/mfa/verify' },
            userId: { type: 'string' },
          },
        },
        Session: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            ipAddress: { type: 'string', nullable: true },
            userAgent: { type: 'string', nullable: true },
            device: {
              type: 'object',
              nullable: true,
              properties: {
                name: { type: 'string' },
                platform: { type: 'string' },
                browser: { type: 'string' },
              },
            },
            lastUsedAt: { type: 'string', format: 'date-time' },
            current: { type: 'boolean' },
          },
        },
        Device: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', nullable: true },
            platform: { type: 'string', nullable: true },
            browser: { type: 'string', nullable: true },
            lastIp: { type: 'string', nullable: true },
            lastSeenAt: { type: 'string', format: 'date-time' },
            isTrusted: { type: 'boolean' },
          },
        },
        AuditLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            action: { type: 'string', example: 'UPDATE' },
            entity: { type: 'string', example: 'user' },
            entityId: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['SUCCESS', 'FAILURE'] },
            before: { type: 'object', nullable: true },
            after: { type: 'object', nullable: true },
            metadata: { type: 'object', nullable: true },
            actorId: { type: 'string', nullable: true },
            ipAddress: { type: 'string', nullable: true },
            requestId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ImportResult: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 50 },
            created: { type: 'integer', example: 47 },
            skipped: { type: 'integer', example: 2 },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: { row: { type: 'integer' }, message: { type: 'string' } },
              },
            },
          },
        },
      },
      // ── Reusable responses ──────────────────────────────────────────
      responses: {
        ValidationError: {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        UnauthorizedError: {
          description: 'Missing/invalid/expired token or credentials',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ForbiddenError: {
          description: 'Authenticated but lacking the required permission',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ConflictError: {
          description: 'Conflict (e.g. duplicate unique value)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      // ── Reusable query/path parameters ──────────────────────────────
      parameters: {
        PageParam: { in: 'query', name: 'page', schema: { type: 'integer', default: 1 }, description: 'Page number' },
        LimitParam: { in: 'query', name: 'limit', schema: { type: 'integer', default: 20, maximum: 100 }, description: 'Items per page' },
        SortParam: { in: 'query', name: 'sort', schema: { type: 'string', example: '-createdAt' }, description: 'Comma-separated fields; prefix with - for descending' },
        SearchParam: { in: 'query', name: 'search', schema: { type: 'string' }, description: 'Free-text search across searchable columns' },
        IdParam: { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Resource id' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/modules/**/*.routes.js', './src/modules/**/*.docs.js'],
});

export default swaggerSpec;
