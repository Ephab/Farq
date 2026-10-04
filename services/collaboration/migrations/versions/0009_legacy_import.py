"""legacy_import: one-time opt-in team moves

Revision ID: 0009_legacy_import
Revises: 0008_team_ai
"""
from alembic import op
import sqlalchemy as sa


revision = '0009_legacy_import'
down_revision = '0008_team_ai'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('legacy_imports',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('importer_id', sa.String(length=36), nullable=False),
    sa.Column('source_team_id', sa.String(length=64), nullable=False),
    sa.Column('team_id', sa.String(length=36), nullable=False),
    sa.Column('bundle_sha256', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['importer_id'], ['accounts.id'], ),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('importer_id', 'source_team_id', name='uq_legacy_import_source')
    )
    op.create_index(op.f('ix_legacy_imports_importer_id'), 'legacy_imports', ['importer_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_legacy_imports_importer_id'), table_name='legacy_imports')
    op.drop_table('legacy_imports')
