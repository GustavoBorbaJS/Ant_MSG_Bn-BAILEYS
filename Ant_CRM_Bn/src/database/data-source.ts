import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Contact } from './entities/contact.entity';
import { Campaign } from './entities/campaign.entity';
import { MessageLog } from './entities/message-log.entity';
import { User } from './entities/user.entity';

// Usado só pelo CLI do TypeORM (migration:generate/run/revert) - a aplicação em
// si usa o DatabaseModule (database.module.ts), não este arquivo.
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'wa_saas',
  entities: [Contact, Campaign, MessageLog, User],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
