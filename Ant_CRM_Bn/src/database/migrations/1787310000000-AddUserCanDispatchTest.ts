import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserCanDispatchTest1787310000000 implements MigrationInterface {
    name = 'AddUserCanDispatchTest1787310000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "canDispatchTest" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "canDispatchTest"`);
    }

}
