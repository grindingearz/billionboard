# BillionBoard Migrations

Run the following to set up the database:

```bash
# Create the database and apply schema
npx prisma migrate dev --name init

# Or push schema directly (no migration history)
npx prisma db push
```

Requires `DATABASE_URL` in `.env` pointing to a running PostgreSQL instance.
