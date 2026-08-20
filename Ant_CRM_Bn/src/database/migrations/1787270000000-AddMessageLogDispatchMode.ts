import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessageLogDispatchMode1787270000000 implements MigrationInterface {
    name = 'AddMessageLogDispatchMode1787270000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "message_logs" ADD "dispatchMode" character varying NOT NULL DEFAULT 'auto'`);
        await queryRunner.query(`ALTER TABLE "message_logs" ADD "dispatchedBy" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "message_logs" DROP COLUMN "dispatchedBy"`);
        await queryRunner.query(`ALTER TABLE "message_logs" DROP COLUMN "dispatchMode"`);
    }

}
