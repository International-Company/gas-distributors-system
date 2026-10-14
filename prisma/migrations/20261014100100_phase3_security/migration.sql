-- ============================================================
-- حماية جداول المرحلة 3 (الجرار والمخزون والشحنات)
-- ============================================================

-- ---------- عزل الصفوف ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cylinders', 'cylinder_operations', 'stations', 'shipments', 'inventory_movements', 'inventory_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_bypass_rls() OR "distributorId" = app_current_distributor()) '
      'WITH CHECK (app_bypass_rls() OR "distributorId" = app_current_distributor())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- ---------- مفاتيح مركّبة: لا ربط بين موزّعين، والجرة في دورة استحقاقها نفسها ----------
ALTER TABLE "entitlements" ADD CONSTRAINT entitlements_id_cycle UNIQUE ("id", "cycleId");
ALTER TABLE "cylinders" ADD CONSTRAINT cylinders_id_dist UNIQUE ("id", "distributorId");
ALTER TABLE "stations" ADD CONSTRAINT stations_id_dist UNIQUE ("id", "distributorId");
ALTER TABLE "shipments" ADD CONSTRAINT shipments_id_dist UNIQUE ("id", "distributorId");
ALTER TABLE "cylinder_operations" ADD CONSTRAINT cylinder_operations_id_dist UNIQUE ("id", "distributorId");

ALTER TABLE "cylinders" ADD CONSTRAINT cylinders_entitlement_dist
  FOREIGN KEY ("entitlementId", "distributorId") REFERENCES "entitlements"("id", "distributorId");
ALTER TABLE "cylinders" ADD CONSTRAINT cylinders_entitlement_cycle
  FOREIGN KEY ("entitlementId", "cycleId") REFERENCES "entitlements"("id", "cycleId");
ALTER TABLE "cylinder_operations" ADD CONSTRAINT cylinder_operations_cylinder_dist
  FOREIGN KEY ("cylinderId", "distributorId") REFERENCES "cylinders"("id", "distributorId");
ALTER TABLE "cylinder_operations" ADD CONSTRAINT cylinder_operations_shipment_dist
  FOREIGN KEY ("shipmentId", "distributorId") REFERENCES "shipments"("id", "distributorId");
ALTER TABLE "shipments" ADD CONSTRAINT shipments_station_dist
  FOREIGN KEY ("stationId", "distributorId") REFERENCES "stations"("id", "distributorId");
ALTER TABLE "stations" ADD CONSTRAINT stations_distributor
  FOREIGN KEY ("distributorId") REFERENCES "distributors"("id");
ALTER TABLE "inventory_balances" ADD CONSTRAINT inventory_balances_distributor
  FOREIGN KEY ("distributorId") REFERENCES "distributors"("id");
ALTER TABLE "inventory_movements" ADD CONSTRAINT inventory_movements_operation_dist
  FOREIGN KEY ("operationId", "distributorId") REFERENCES "cylinder_operations"("id", "distributorId");
ALTER TABLE "inventory_movements" ADD CONSTRAINT inventory_movements_shipment_dist
  FOREIGN KEY ("shipmentId", "distributorId") REFERENCES "shipments"("id", "distributorId");
ALTER TABLE "inventory_movements" ADD CONSTRAINT inventory_movements_reverses
  FOREIGN KEY ("reversesId") REFERENCES "inventory_movements"("id");

-- ---------- قواعد العمل ----------
-- الجرة الواحدة من الاستحقاق لا تُستلم مرتين (ما لم تُلغَ).
CREATE UNIQUE INDEX cylinders_unit_once ON "cylinders" ("entitlementId", "seq") WHERE "status" <> 'VOID';
-- رقم الجرة فريد داخل الدورة.
CREATE UNIQUE INDEX cylinders_label_per_cycle ON "cylinders" ("cycleId", "label") WHERE "status" <> 'VOID';
-- عملية نافذة واحدة من كل نوع لكل جرة: لا تعبئة مكررة ولا تسليم مكرر.
CREATE UNIQUE INDEX cylinder_operations_once ON "cylinder_operations" ("cylinderId", "type") WHERE "status" = 'ACTIVE';

ALTER TABLE "cylinders" ADD CONSTRAINT cylinders_seq_positive CHECK ("seq" >= 1);
ALTER TABLE "cylinder_operations" ADD CONSTRAINT cylinder_operations_cancel_consistent CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
ALTER TABLE "shipments" ADD CONSTRAINT shipments_counts CHECK (
  "quantity" > 0 AND "linkedCount" >= 0 AND "extraCount" >= 0 AND "quantity" = "linkedCount" + "extraCount"
);
ALTER TABLE "shipments" ADD CONSTRAINT shipments_cancel_consistent CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
-- المخزون لا يصبح سالبًا: أي حركة تؤدي لذلك تُرفض (حركة غير منطقية).
ALTER TABLE "inventory_balances" ADD CONSTRAINT inventory_balances_non_negative CHECK ("empty" >= 0 AND "filled" >= 0 AND "extra" >= 0);
ALTER TABLE "inventory_movements" ADD CONSTRAINT inventory_movements_after_non_negative CHECK ("emptyAfter" >= 0 AND "filledAfter" >= 0 AND "extraAfter" >= 0);
ALTER TABLE "inventory_movements" ADD CONSTRAINT inventory_movements_reversal_ref CHECK (("type" = 'REVERSAL') = ("reversesId" IS NOT NULL));

-- ---------- سجل الحركة للإضافة فقط ----------
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION app_forbid_modification();
