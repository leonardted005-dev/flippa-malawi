-- Runs on first Postgres initialization (docker-compose).
-- Creates the scratch database used for Prisma migration drift checks.
CREATE DATABASE flippa_africa_shadow;
