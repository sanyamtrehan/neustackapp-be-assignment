import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://checkout:checkout@localhost:5432/checkout',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  // Schema changes go through migrations so constraints are reviewable.
  synchronize: false,
};

// Consumed by the TypeORM CLI; the application uses dataSourceOptions directly.
export default new DataSource(dataSourceOptions);
