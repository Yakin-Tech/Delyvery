export function describeAuditAction(entry, t) {
  const actor = entry.user?.name || t('auditLogDescriptions.someone');
  const orgName = entry.organization?.name || t('auditLogDescriptions.anOrganization');
  const verb = t(`auditLogDescriptions.actions.${entry.action}`, { defaultValue: entry.action });

  if ((entry.action === 'organization_status_changed' || entry.action === 'organization_delivery_model_changed') && entry.metadata) {
    return `${actor} ${verb} ${orgName}: ${entry.metadata.from} → ${entry.metadata.to}`;
  }

  return `${actor} ${verb} ${orgName}`;
}
