import { MigrationInterface, QueryRunner } from "typeorm";

export class InitCrmSchema1787251830921 implements MigrationInterface {
    name = 'InitCrmSchema1787251830921'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "contacts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "phone" character varying NOT NULL, "tags" text array NOT NULL DEFAULT '{}', "notes" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b99cd40cfd66a99f1571f4f72e6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_84cae51c485079bdd8cdf1d828" ON "contacts" ("phone") `);
        await queryRunner.query(`CREATE TABLE "campaigns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "text" text NOT NULL, "lastDispatchedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_831e3fcd4fc45b4e4c3f57a9ee4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "message_logs" ADD "campaignId" uuid`);
        await queryRunner.query(`ALTER TABLE "message_logs" ADD "contactId" uuid`);
        await queryRunner.query(`ALTER TABLE "message_logs" ADD CONSTRAINT "FK_66521bb3c5deadf214d574657a2" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_logs" ADD CONSTRAINT "FK_b7e3f72a660834936fd2569dfb9" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "message_logs" DROP CONSTRAINT "FK_b7e3f72a660834936fd2569dfb9"`);
        await queryRunner.query(`ALTER TABLE "message_logs" DROP CONSTRAINT "FK_66521bb3c5deadf214d574657a2"`);
        await queryRunner.query(`ALTER TABLE "message_logs" DROP COLUMN "contactId"`);
        await queryRunner.query(`ALTER TABLE "message_logs" DROP COLUMN "campaignId"`);
        await queryRunner.query(`DROP TABLE "campaigns"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_84cae51c485079bdd8cdf1d828"`);
        await queryRunner.query(`DROP TABLE "contacts"`);
    }

}
