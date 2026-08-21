import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCampaignImage1787290000000 implements MigrationInterface {
    name = 'AddCampaignImage1787290000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "campaigns" ADD "imageFilename" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "imageFilename"`);
    }

}
