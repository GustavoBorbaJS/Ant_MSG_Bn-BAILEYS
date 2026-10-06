import { MigrationInterface, QueryRunner } from "typeorm";

// Lista de quem respondeu "Não tenho interesse" (ou foi marcado no painel) -
// ver OptOutsService. ON DELETE CASCADE: remover o usuário leva junto os
// bloqueios da lista dele, sem precisar de limpeza manual no UsersService.
export class AddOptOuts1787330000000 implements MigrationInterface {
    name = 'AddOptOuts1787330000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "opt_outs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ownerId" uuid NOT NULL, "phoneKey" character varying NOT NULL, "source" character varying NOT NULL DEFAULT 'reply', "instanceId" character varying, "replyText" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_opt_outs" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_opt_outs_owner_phone" ON "opt_outs" ("ownerId", "phoneKey")`);
        await queryRunner.query(`ALTER TABLE "opt_outs" ADD CONSTRAINT "FK_opt_outs_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "opt_outs"`);
    }

}
