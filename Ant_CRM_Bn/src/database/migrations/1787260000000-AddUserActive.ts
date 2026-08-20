import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserActive1787260000000 implements MigrationInterface {
    name = 'AddUserActive1787260000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "active" boolean NOT NULL DEFAULT true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "active"`);
    }

}
