"""device_auth: silent device accounts

Revision ID: 0010_device_auth
Revises: 0009_legacy_import
"""
from alembic import op
import sqlalchemy as sa


revision = '0010_device_auth'
down_revision = '0009_legacy_import'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('device_keys',
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('public_key', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.PrimaryKeyConstraint('account_id'),
    sa.UniqueConstraint('public_key')
    )
    op.create_index(op.f('ix_device_keys_created_at'), 'device_keys', ['created_at'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_device_keys_created_at'), table_name='device_keys')
    op.drop_table('device_keys')
