"""team_ai: durable run claiming and per-run tool grants

Revision ID: 0008_team_ai
Revises: 0007_team_profiles
"""
from alembic import op
import sqlalchemy as sa


revision = '0008_team_ai'
down_revision = '0007_team_profiles'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('team_agent_runs', sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('team_agent_runs', sa.Column('claimed_by', sa.String(length=36), nullable=True))
    op.add_column('team_agent_runs', sa.Column('lease_expires', sa.DateTime(timezone=True), nullable=True))
    op.add_column('team_agent_runs', sa.Column('reply_message_id', sa.String(length=36), nullable=True))
    op.alter_column('team_agent_runs', 'attempts', server_default=None)
    op.add_column('team_proposals', sa.Column('request_key', sa.String(length=64), nullable=True))
    op.create_unique_constraint('uq_proposal_run_request', 'team_proposals', ['run_id', 'request_key'])
    op.create_table('team_run_grants',
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('run_id', sa.String(length=36), nullable=False),
    sa.Column('team_id', sa.String(length=36), nullable=False),
    sa.Column('actor_id', sa.String(length=36), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['accounts.id'], ),
    sa.ForeignKeyConstraint(['run_id'], ['team_agent_runs.id'], ),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('token_hash')
    )
    op.create_index(op.f('ix_team_run_grants_run_id'), 'team_run_grants', ['run_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_team_run_grants_run_id'), table_name='team_run_grants')
    op.drop_table('team_run_grants')
    op.drop_constraint('uq_proposal_run_request', 'team_proposals', type_='unique')
    op.drop_column('team_proposals', 'request_key')
    op.drop_column('team_agent_runs', 'reply_message_id')
    op.drop_column('team_agent_runs', 'lease_expires')
    op.drop_column('team_agent_runs', 'claimed_by')
    op.drop_column('team_agent_runs', 'attempts')
