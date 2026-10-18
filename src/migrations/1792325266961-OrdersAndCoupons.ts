import { MigrationInterface, QueryRunner } from "typeorm";

export class OrdersAndCoupons1792325266961 implements MigrationInterface {
    name = 'OrdersAndCoupons1792325266961'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "coupons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(40) NOT NULL, "percent_off" integer NOT NULL, "milestone_order_count" integer NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'available', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e025109230e82925843f2a14c48" UNIQUE ("code"), CONSTRAINT "UQ_0b15e175a40df7b8f3eac14bb4e" UNIQUE ("milestone_order_count"), CONSTRAINT "coupons_percent_off_range" CHECK ("percent_off" > 0 AND "percent_off" <= 100), CONSTRAINT "coupons_status_valid" CHECK ("status" IN ('available', 'redeemed')), CONSTRAINT "PK_d7ea8864a0150183770f3e9a8cb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "product_name" character varying(200) NOT NULL, "unit_price_minor" integer NOT NULL, "quantity" integer NOT NULL, "line_total_minor" integer NOT NULL, CONSTRAINT "order_items_line_total_consistent" CHECK ("line_total_minor" = "unit_price_minor" * "quantity"), CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "cart_id" uuid NOT NULL, "subtotal_minor" integer NOT NULL, "discount_minor" integer NOT NULL DEFAULT '0', "total_minor" integer NOT NULL, "coupon_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_6284f0f60e4cb96c12ff96f0f15" UNIQUE ("coupon_id"), CONSTRAINT "REL_f42b1d95404c45b10bf2451d81" UNIQUE ("cart_id"), CONSTRAINT "orders_total_is_subtotal_less_discount" CHECK ("total_minor" = "subtotal_minor" - "discount_minor"), CONSTRAINT "orders_amounts_non_negative" CHECK ("subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "total_minor" >= 0), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_f42b1d95404c45b10bf2451d814" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_6284f0f60e4cb96c12ff96f0f15" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_6284f0f60e4cb96c12ff96f0f15"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_f42b1d95404c45b10bf2451d814"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP TABLE "coupons"`);
    }

}
