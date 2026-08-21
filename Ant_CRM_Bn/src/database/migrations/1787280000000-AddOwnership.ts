import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOwnership1787280000000 implements MigrationInterface {
    name = 'AddOwnership1787280000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // instance_owners: mapeia instanceId (do Engine, sem noção de usuário) pro
        // dono no CRM. Sem registro aqui = instância "legada", tratada como do
        // admin em runtime (ver InstanceOwnersService) - não precisa backfill aqui.
        await queryRunner.query(`CREATE TABLE "instance_owners" ("instanceId" character varying NOT NULL, "ownerId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_instance_owners_instanceId" PRIMARY KEY ("instanceId"))`);
        await queryRunner.query(`ALTER TABLE "instance_owners" ADD CONSTRAINT "FK_instance_owners_ownerId" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // contacts: telefone deixa de ser unique global e passa a ser unique por dono
        await queryRunner.query(`DROP INDEX "public"."IDX_84cae51c485079bdd8cdf1d828"`);
        await queryRunner.query(`ALTER TABLE "contacts" ADD "ownerId" uuid`);
        await queryRunner.query(`UPDATE "contacts" SET "ownerId" = (SELECT "id" FROM "users" WHERE "username" = 'admin' LIMIT 1)`);
        await queryRunner.query(`ALTER TABLE "contacts" ALTER COLUMN "ownerId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "contacts" ADD CONSTRAINT "FK_contacts_ownerId" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_contacts_phone_ownerId" ON "contacts" ("phone", "ownerId")`);

        // campaigns
        await queryRunner.query(`ALTER TABLE "campaigns" ADD "ownerId" uuid`);
        await queryRunner.query(`UPDATE "campaigns" SET "ownerId" = (SELECT "id" FROM "users" WHERE "username" = 'admin' LIMIT 1)`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "ownerId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "campaigns" ADD CONSTRAINT "FK_campaigns_ownerId" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // message_logs.dispatchedBy já existe (AddMessageLogDispatchMode) mas ficou
        // NULL nas linhas antigas (dispatch feito antes desse campo existir) -
        // backfill pra admin, pra aba "atividade dos usuários" não perder registros.
        await queryRunner.query(`UPDATE "message_logs" SET "dispatchedBy" = (SELECT "id" FROM "users" WHERE "username" = 'admin' LIMIT 1) WHERE "dispatchedBy" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "campaigns" DROP CONSTRAINT "FK_campaigns_ownerId"`);
        await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "ownerId"`);

        await queryRunner.query(`DROP INDEX "public"."IDX_contacts_phone_ownerId"`);
        await queryRunner.query(`ALTER TABLE "contacts" DROP CONSTRAINT "FK_contacts_ownerId"`);
        await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "ownerId"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_84cae51c485079bdd8cdf1d828" ON "contacts" ("phone")`);

        await queryRunner.query(`ALTER TABLE "instance_owners" DROP CONSTRAINT "FK_instance_owners_ownerId"`);
        await queryRunner.query(`DROP TABLE "instance_owners"`);
    }

}
