import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserAvatar1787300000000 implements MigrationInterface {
    name = 'AddUserAvatar1787300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "avatarFilename" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatarFilename"`);
    }

}
