import { MigrationInterface, QueryRunner } from "typeorm";

// Configuração de IA por usuário (provedor, modelo e chave de API cifrada) -
// ver AiSettingsService. ON DELETE CASCADE: remover o usuário leva a chave
// dele junto.
export class AddAiSettings1787340000000 implements MigrationInterface {
    name = 'AddAiSettings1787340000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ai_settings" ("userId" uuid NOT NULL, "provider" character varying NOT NULL, "model" character varying NOT NULL, "apiKeyEnc" text NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ai_settings" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`ALTER TABLE "ai_settings" ADD CONSTRAINT "FK_ai_settings_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "ai_settings"`);
    }

}
