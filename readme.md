

pnpm add -D node-pg-migrate

pnpm dlx node-pg-migrate create create-users-table  // to create migration file

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres

pnpm migrate or
pnpm migrate:down




