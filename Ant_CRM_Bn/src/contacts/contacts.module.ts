import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../database/entities/contact.entity';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { OptOutsModule } from '../opt-outs/opt-outs.module';

@Module({
  imports: [TypeOrmModule.forFeature([Contact]), OptOutsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
