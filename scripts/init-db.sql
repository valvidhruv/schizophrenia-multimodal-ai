-- scripts/init-db.sql
-- Database initialization script for PostgreSQL

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS public;

-- Set default search path
ALTER DATABASE schizophrenia_ai SET search_path = public;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE schizophrenia_ai TO dev;
GRANT ALL ON SCHEMA public TO dev;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dev;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO dev;

-- Default admin user will be created by Prisma seed