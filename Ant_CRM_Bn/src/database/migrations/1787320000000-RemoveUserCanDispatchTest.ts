import { MigrationInterface, QueryRunner } from "typeorm";

// Remove a coluna do fixture de disparo de teste (ver AddUserCanDispatchTest)
// - a ferramenta de diagnostico inteira foi removida do codigo, essa coluna
// ficou orfa.
export class RemoveUserCanDispatchTest1787320000000 implements MigrationInterface {
    name = 'RemoveUserCanDispatchTest1787320000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "canDispatchTest"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "canDispatchTest" boolean NOT NULL DEFAULT false`);
    }

}
