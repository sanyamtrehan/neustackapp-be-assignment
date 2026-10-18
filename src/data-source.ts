import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';

// Defaults mirror docker-compose.yml, so a fresh clone with no .env still runs.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'checkout',
  password: process.env.DB_PASSWORD ?? 'checkout',
  database: process.env.DB_NAME ?? 'checkout',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  // Schema changes go through migrations so constraints are reviewable.
  synchronize: false,
  extra: {
    max: 10,
    // Fail a request that cannot get a connection instead of waiting for one
    // forever. Without this, code that holds a connection while asking for a
    // second one takes the whole service down rather than erroring.
    connectionTimeoutMillis: 5_000,
  },
};

// Consumed by the TypeORM CLI; the application uses dataSourceOptions directly.
export default new DataSource(dataSourceOptions);
